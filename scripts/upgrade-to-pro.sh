#!/usr/bin/env bash
# Przejście z wersji LITE na PRO po zakupie licencji (SSH, katalog projektu):
#   sudo bash scripts/upgrade-to-pro.sh
# Kroki: 1) klucz licencyjny: wklejony w panelu (Ustawienia → Wersja PRO; skrypt o nic nie pyta), przy ponownym
#           uruchomieniu – zapisany przy aktywacji, a bez nich – wpisany tutaj,
#        2) klucz SSH tego NAS-a (tylko do odczytu) i aktywacja licencji na tym NAS-ie – publiczna część klucza
#           trafia do aktywacji, a sprzedawca dodaje ją do prywatnego repozytorium PRO,
#        3) czekanie na dostęp do repozytorium PRO (zwykle kilka minut),
#        4) przełączenie katalogu projektu na wersję PRO i scripts/update.sh (przebudowa panelu, import workflow).
# Boty, klucze API, konta i historia (data/, .env) zostają bez zmian. Skrypt można uruchomić ponownie – zapisana
# aktywacja nie zajmuje drugiego urządzenia licencji. W wersji PRO z licencją aktywuje NAS ponownie (np. zwolnione
# urządzenie; nowy klucz licencyjny wklejasz w panelu) i pobiera aktualizacje. POSTER_PRO_WAIT – ile sekund czekać na dostęp
# (domyślnie 900).
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lang.sh
. scripts/license.sh

info() { printf '\033[1;34m[pro]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(m uwaga note)" "$*"; }
die() { printf '\033[1;31m[%s]\033[0m %s\n' "$(m błąd error)" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "$(m "Uruchom przez sudo: sudo bash scripts/upgrade-to-pro.sh" "Run it with sudo: sudo bash scripts/upgrade-to-pro.sh")"
command -v docker >/dev/null || die "$(m "Brak polecenia docker." "The docker command is missing.")"
[ -d .git ] || die "$(m "Katalog projektu nie jest klonem gita (np. instalacja z ZIP-a). Zainstaluj wersję LITE przez git według README (katalogi data/ i plik .env możesz przenieść), potem uruchom skrypt ponownie." \
  "The project directory is not a git clone (e.g. installed from a ZIP). Install LITE with git as described in the README (you can move the data/ directory and the .env file), then run the script again.")"

# git w kontenerze (na NAS-ie nie trzeba instalować gita); safe.directory – patrz scripts/update.sh
dgit() { docker run --rm -v "$PWD":/git alpine/git -c safe.directory=/git "$@"; }

ORIGIN="$(dgit remote get-url origin)" || die "$(m "Nie mogę odczytać adresu repozytorium (git remote get-url origin)." \
  "Cannot read the repository address (git remote get-url origin).")"
ALREADY_PRO=0
if [ "$ORIGIN" = "$PRO_REPO" ]; then
  if [ ! -f "$PRO_STATE" ]; then # wersja PRO bez licencji na tym NAS-ie (np. wdrożenie) – nic do zrobienia
    info "$(m "To już jest wersja PRO. Aktualizacje: sudo bash scripts/update.sh" "This is already the PRO edition. Updates: sudo bash scripts/update.sh")"
    exit 0
  fi
  ALREADY_PRO=1
fi
license_image

# 1) Klucz licencyjny: z panelu (sprawdzony już w Polarze; license-cli.js usuwa kopię po aktywacji), zapisany przy
# poprzedniej aktywacji (ponowne uruchomienie – ta sama aktywacja) albo wpisany tutaj
KEY_FROM=prompt
if [ -f "$PANEL_KEY" ]; then
  KEY_FROM=panel
  info "$(m "Biorę klucz licencyjny wklejony w panelu (Ustawienia → Wersja PRO)." \
    "Using the license key pasted in the panel (Settings → PRO edition).")"
elif [ -f "$PRO_STATE" ]; then
  KEY_FROM=saved
  info "$(m "Używam klucza licencyjnego z poprzedniej aktywacji tego NAS-a (nowy klucz wklejasz w panelu)." \
    "Using the license key from this NAS's previous activation (paste a new key in the panel).")"
else
  read -r -p "$(m "Klucz licencyjny Postera PRO (strona zamówienia – „Access purchase” w e-mailu od Polara): " "Poster PRO license key (order page – “Access purchase” in the email from Polar): ")" LICENSE_KEY || true
  LICENSE_KEY="$(printf '%s' "${LICENSE_KEY:-}" | tr -d '[:space:]')"
  [ -n "$LICENSE_KEY" ] || die "$(m "Nie podano klucza licencyjnego." "No license key given.")"
fi

# 2) Klucz SSH NAS-a (tworzony raz) i aktywacja licencji na tym NAS-ie
if [ ! -f "$PRO_KEY" ]; then
  info "$(m "Tworzę klucz dostępu tego NAS-a (tylko do odczytu)..." "Creating this NAS's access key (read-only)...")"
  if command -v ssh-keygen >/dev/null; then
    ssh-keygen -q -t ed25519 -N "" -C "poster-pro" -f "$PRO_KEY"
  else
    docker run --rm -v "$PWD":/git --entrypoint ssh-keygen alpine/git -q -t ed25519 -N "" -C "poster-pro" -f "/git/$PRO_KEY"
  fi
fi
chmod 600 "$PRO_KEY" 2>/dev/null || true # na części udziałów NAS nie działa – patrz PRO_SSH

info "$(m "Aktywuję licencję na tym NAS-ie..." "Activating the license on this NAS...")"
LABEL="$(hostname 2>/dev/null || uname -n)"
case "$KEY_FROM" in
  panel) license_read "$(license_cli activate "${LABEL:-NAS}" "$PRO_KEY.pub" --pending </dev/null || true)" ;;
  saved) license_read "$(license_cli activate "${LABEL:-NAS}" "$PRO_KEY.pub" --saved </dev/null || true)" ;;
  *) license_read "$(printf '%s\n' "$LICENSE_KEY" | license_cli activate "${LABEL:-NAS}" "$PRO_KEY.pub" || true)" ;;
esac
# nieznany albo cofnięty klucz z panelu jest już usunięty – nowy wklejasz w panelu
AGAIN=""
[ "$KEY_FROM" = prompt ] || AGAIN=" $(m "Wklej poprawny klucz w panelu (Ustawienia → Wersja PRO)." "Paste the right key in the panel (Settings → PRO edition).")"
case "$LIC_RESULT" in
  ok)
    UNTIL="$(license_until)"
    info "$(m "Licencja ważna${UNTIL:+ – $UNTIL}${LIC_LIMIT:+ (urządzenia: do $LIC_LIMIT)}." \
      "The license is valid${UNTIL:+ – $UNTIL}${LIC_LIMIT:+ (devices: up to $LIC_LIMIT)}.")"
    ;;
  invalid) die "$(m "Nieznany klucz licencyjny – skopiuj go w całości ze strony zamówienia (przycisk „Access purchase” w e-mailu od Polara) i spróbuj ponownie." \
    "Unknown license key – copy the whole key from the order page (the “Access purchase” button in the email from Polar) and try again.")$AGAIN" ;;
  expired) die "$(m "Ta licencja nie obejmuje już aktualizacji – przedłużysz ją tutaj: $LIC_RENEW" \
    "This license no longer includes updates – renew it here: $LIC_RENEW")" ;;
  inactive) die "$(m "Ta licencja jest nieaktywna (np. po zwrocie płatności). Pytania: $LIC_PRODUCT" \
    "This license is inactive (e.g. after a refund). Questions: $LIC_PRODUCT")$AGAIN" ;;
  none) die "$(m "Nie mam klucza licencyjnego – wklej go w panelu (Ustawienia → Wersja PRO) i uruchom skrypt ponownie." \
    "No license key – paste it in the panel (Settings → PRO edition) and run the script again.")" ;;
  limit) die "$(m "Licencja jest już aktywna na wszystkich urządzeniach. Żeby zwolnić jedno, napisz do sprzedawcy: $LIC_PRODUCT" \
    "The license is already active on all its devices. To free one, contact the seller: $LIC_PRODUCT")" ;;
  config) die "$(m "Sprzedaż wersji PRO jeszcze nie ruszyła – szczegóły: $LIC_PRODUCT" "PRO sales have not started yet – details: $LIC_PRODUCT")" ;;
  network) die "$(m "Brak połączenia z serwerem licencji (Polar) – sprawdź internet na NAS-ie i spróbuj ponownie.${LIC_DETAIL:+ ($LIC_DETAIL)}" \
    "No connection to the license server (Polar) – check the NAS's internet connection and try again.${LIC_DETAIL:+ ($LIC_DETAIL)}")" ;;
  *) die "$(m "Serwer licencji odpowiedział błędem: ${LIC_DETAIL:-$LIC_RESULT}" "The license server returned an error: ${LIC_DETAIL:-$LIC_RESULT}")" ;;
esac

# 3) Dostęp do repozytorium PRO: sprzedawca dodaje klucz NAS-a po aktywacji. Udziały NAS-a (np. UGOS) często wymuszają
# uprawnienia 0777, a ssh odrzuca klucz dostępny dla innych – git w kontenerze używa więc kopii klucza z uprawnieniami 600
# (jak scripts/setup-deploy-key.sh). Klucz hosta GitHuba jest znany z góry (github.com → SSH key fingerprints).
KNOWN=.git/poster-known-hosts
grep -qs '^github\.com ssh-ed25519 ' "$KNOWN" ||
  echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' >>"$KNOWN"
PRO_SSH="umask 077; cat /git/$PRO_KEY > /tmp/poster-pro-key; ssh -i /tmp/poster-pro-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/git/$KNOWN"
pgit() { dgit -c "core.sshCommand=$PRO_SSH" -c ssh.variant=ssh "$@"; }

WAIT="${POSTER_PRO_WAIT:-900}"
info "$(m "Czekam na dostęp do repozytorium PRO (zwykle 1–5 min)..." "Waiting for access to the PRO repository (usually 1–5 min)...")"
START=$SECONDS
until pgit ls-remote --heads "$PRO_REPO" >/dev/null 2>&1; do
  if [ $((SECONDS - START)) -ge "$WAIT" ]; then
    warn "$(m "Dostęp nie jest jeszcze gotowy. Licencja i klucz NAS-a są zapisane – uruchom skrypt ponownie za kilka minut (nie zajmie drugiego urządzenia)." \
      "Access is not ready yet. The license and the NAS key are saved – run the script again in a few minutes (it will not use a second device).")"
    warn "$(m "Jeśli to się powtarza, napisz do sprzedawcy: $LIC_PRODUCT" "If this keeps happening, contact the seller: $LIC_PRODUCT")"
    warn "$(m "Zapora sieci musi przepuszczać ruch wychodzący na github.com:22 (SSH)." "The firewall must allow outgoing traffic to github.com:22 (SSH).")"
    exit 1
  fi
  sleep 15
done

if [ "$ALREADY_PRO" -eq 1 ]; then
  info "$(m "Dostęp do repozytorium PRO działa – pobieram aktualizacje..." "Access to the PRO repository works – downloading updates...")"
  exec bash scripts/update.sh
fi

# 4) Przełączenie na wersję PRO: origin → repozytorium PRO, gałąź main → wersja PRO (lokalne zmiany w plikach programu
# zatrzymują przełączenie – wtedy wszystko wraca do stanu sprzed skryptu)
info "$(m "Pobieram wersję PRO..." "Downloading the PRO edition...")"
OLD_SSH="$(dgit config --get core.sshCommand || true)"
OLD_VARIANT="$(dgit config --get ssh.variant || true)"
restore() {
  dgit remote set-url origin "$ORIGIN" || true
  if [ -n "$OLD_SSH" ]; then dgit config core.sshCommand "$OLD_SSH"; else dgit config --unset core.sshCommand || true; fi
  if [ -n "$OLD_VARIANT" ]; then dgit config ssh.variant "$OLD_VARIANT"; else dgit config --unset ssh.variant || true; fi
  dgit fetch --quiet origin >/dev/null 2>&1 || true
}
dgit config core.sshCommand "$PRO_SSH"
dgit config ssh.variant ssh # polecenie zaczyna się od „umask”, więc mówimy gitowi wprost, że to OpenSSH
dgit remote set-url origin "$PRO_REPO"
if ! dgit fetch --quiet origin || ! dgit checkout -q -B main --track origin/main; then
  restore
  die "$(m "Nie udało się przełączyć na wersję PRO (wyżej komunikat gita) – katalog projektu został bez zmian. Lokalne zmiany w plikach programu pokaże: sudo docker run --rm -v \"\$PWD\":/git alpine/git -c safe.directory=/git status" \
    "Could not switch to the PRO edition (git message above) – the project directory is unchanged. Local changes in the program files: sudo docker run --rm -v \"\$PWD\":/git alpine/git -c safe.directory=/git status")"
fi

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' panel/package.json | head -n1)"
info "$(m "Przebudowuję panel i importuję workflow (Poster PRO $VERSION)..." "Rebuilding the panel and importing the workflow (Poster PRO $VERSION)...")"
bash scripts/update.sh --no-pull || die "$(m "Wersja PRO jest pobrana, ale przebudowa się nie udała – popraw błąd powyżej i uruchom: sudo bash scripts/update.sh" \
  "The PRO edition is downloaded, but the rebuild failed – fix the error above and run: sudo bash scripts/update.sh")"
info "$(m "Gotowe: Poster PRO $VERSION. Boty, klucze i historia zostały bez zmian. Aktualizacje: sudo bash scripts/update.sh" \
  "Done: Poster PRO $VERSION. Bots, keys and history are unchanged. Updates: sudo bash scripts/update.sh")"
