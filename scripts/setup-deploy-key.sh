#!/usr/bin/env bash
# Jednorazowo podłącza NAS do repozytorium GitHub przez „deploy key” – klucz SSH tylko do odczytu
# i tylko dla tego jednego repozytorium. Potem `git pull` i scripts/update.sh działają bez logowania
# i bez tokenu (klucz nie wygasa; w każdej chwili usuniesz go w GitHub → repo → Settings → Deploy keys).
#
# Użycie (SSH, katalog projektu):  sudo bash scripts/setup-deploy-key.sh
#
# Klucz leży w .git/poster-deploy-key (tylko root, poza plikami projektu), a git w kontenerze alpine/git
# używa go dzięki ustawieniu core.sshCommand zapisanemu w .git/config.
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lang.sh

info() { printf '\033[1;34m[deploy-key]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(m uwaga note)" "$*"; }
die() { printf '\033[1;31m[%s]\033[0m %s\n' "$(m błąd error)" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "$(m "Uruchom przez sudo: sudo bash scripts/setup-deploy-key.sh" "Run it with sudo: sudo bash scripts/setup-deploy-key.sh")"
[ -d .git ] || die "$(m "Katalog projektu nie jest klonem gita (brak .git) – sklonuj repozytorium według README." \
  "The project directory is not a git clone (no .git) – clone the repository as described in the README.")"
command -v docker >/dev/null || die "$(m "Brak polecenia docker." "The docker command is missing.")"

KEY=.git/poster-deploy-key
# Udziały NAS-a (np. UGOS) często wymuszają uprawnienia 0777 na plikach, a ssh odrzuca klucz dostępny
# dla innych („UNPROTECTED PRIVATE KEY FILE”). Dlatego przy każdym połączeniu git w kontenerze kopiuje
# klucz do swojego /tmp z uprawnieniami 600 (umask 077) i używa tej kopii – znika razem z kontenerem.
SSH_COMMAND="umask 077; cat /git/$KEY > /tmp/poster-deploy-key; ssh -i /tmp/poster-deploy-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/git/.git/poster-known-hosts"

# git w kontenerze (na NAS-ie nie trzeba instalować gita); safe.directory – patrz scripts/update.sh
dgit() { docker run --rm -v "$PWD":/git alpine/git -c safe.directory=/git "$@"; }

ORIGIN="$(dgit remote get-url origin)" || die "$(m "Nie mogę odczytać adresu repozytorium (git remote get-url origin)." \
  "Cannot read the repository address (git remote get-url origin).")"
SLUG="$(printf '%s' "$ORIGIN" | sed -E 's#^(https://([^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#\.git$##; s#/$##')"
case "$SLUG" in
  */*) ;;
  *) die "$(m "Nieobsługiwany adres repozytorium: $ORIGIN" "Unsupported repository address: $ORIGIN")" ;;
esac
info "$(m "Repozytorium: $SLUG" "Repository: $SLUG")"

# 1) Klucz (tworzony tylko raz)
if [ ! -f "$KEY" ]; then
  info "$(m "Tworzę klucz SSH..." "Creating the SSH key...")"
  if command -v ssh-keygen >/dev/null; then
    ssh-keygen -q -t ed25519 -N "" -C "poster-nas" -f "$KEY"
  else
    docker run --rm -v "$PWD":/git --entrypoint ssh-keygen alpine/git -q -t ed25519 -N "" -C "poster-nas" -f "/git/$KEY"
  fi
fi
chmod 600 "$KEY" 2>/dev/null || true # na części udziałów NAS nie działa – patrz SSH_COMMAND

if [ "$UI_LANG" = en ]; then
  cat <<EOF

1. Open in your browser (signed in to GitHub as the repository owner):

     https://github.com/$SLUG/settings/keys/new

2. Title: NAS
   Key: paste the WHOLE line below (it starts with ssh-ed25519):

$(cat "$KEY.pub")

3. Do NOT tick “Allow write access” (the NAS only downloads) and click “Add key”.

EOF
else
  cat <<EOF

1. Otwórz w przeglądarce (zalogowany na GitHubie jako właściciel repozytorium):

     https://github.com/$SLUG/settings/keys/new

2. Title: NAS
   Key: wklej CAŁĄ linię poniżej (zaczyna się od ssh-ed25519):

$(cat "$KEY.pub")

3. NIE zaznaczaj „Allow write access” (NAS tylko pobiera) i kliknij „Add key”.

EOF
fi
read -r -p "$(m "Gdy klucz jest dodany na GitHubie, naciśnij Enter... " "When the key is added on GitHub, press Enter... ")" _

# 2) Git w kontenerze używa klucza, a repozytorium pobieramy przez SSH
dgit config core.sshCommand "$SSH_COMMAND"
dgit config ssh.variant ssh # polecenie zaczyna się od „umask”, więc mówimy gitowi wprost, że to OpenSSH
dgit remote set-url origin "git@github.com:$SLUG.git"

info "$(m "Sprawdzam połączenie (git fetch)..." "Checking the connection (git fetch)...")"
if dgit fetch --quiet origin; then
  info "$(m "Działa. Aktualizacje bez hasła i tokenu:" "It works. Updates without a password or token:")"
  echo "   sudo bash scripts/update.sh"
  echo "   ($(m "albo ręcznie" "or by hand"): sudo docker run --rm -it -v \"\$PWD\":/git alpine/git -c safe.directory=/git pull)"
else
  dgit remote set-url origin "$ORIGIN"
  warn "$(m "Połączenie nie działa – przywróciłem poprzedni adres repozytorium ($ORIGIN)." \
    "The connection does not work – the previous repository address is restored ($ORIGIN).")"
  warn "$(m "Sprawdź, czy klucz został dodany do właściwego repozytorium, i uruchom skrypt ponownie." \
    "Check that the key was added to the right repository and run the script again.")"
  warn "$(m "Zapora sieci musi przepuszczać ruch wychodzący na github.com:22 (SSH)." \
    "The firewall must allow outgoing traffic to github.com:22 (SSH).")"
  exit 1
fi
