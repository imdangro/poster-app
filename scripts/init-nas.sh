#!/usr/bin/env bash
# Przygotowuje katalog projektu na NAS-ie lub serwerze: .env, klucze (n8n + panel), katalogi danych z uprawnieniami 1000:1000
# i ścieżkę katalogu projektu dla panelu (data/panel/install.json – gotowe polecenia, np. przejście na PRO).
# Użycie (przez SSH, w katalogu projektu):  sudo bash scripts/init-nas.sh
# Można uruchamiać wielokrotnie (np. po aktualizacji) – istniejących wartości w .env nie zmienia.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
N8N_UID=1000
N8N_GID=1000
. scripts/lang.sh

info() { printf '\033[1;34m[init]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(m uwaga note)" "$*"; }
die() { printf '\033[1;31m[%s]\033[0m %s\n' "$(m błąd error)" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "$(m "Uruchom przez sudo: sudo bash scripts/init-nas.sh" "Run it with sudo: sudo bash scripts/init-nas.sh")"
command -v docker >/dev/null || die "$(m "Brak polecenia docker – zainstaluj Dockera (na UGOS: aplikacja Docker w App Center)." \
  "The docker command is missing – install Docker (on UGOS: the Docker app in the App Center).")"
docker compose version >/dev/null 2>&1 || die "$(m "Brak 'docker compose' (v2) – zainstaluj Docker Compose v2 (na UGOS: zaktualizuj aplikację Docker)." \
  "'docker compose' (v2) is missing – install Docker Compose v2 (on UGOS: update the Docker app).")"

info "$(m "Katalog projektu: $PROJECT_DIR" "Project directory: $PROJECT_DIR")"

# 1) .env
if [ ! -f .env ]; then
  cp .env.example .env
  info "$(m "Utworzono .env z .env.example – uzupełnij go (sudo nano .env)." "Created .env from .env.example – fill it in (sudo nano .env).")"
fi
chmod 600 .env

# 2) Klucze generowane automatycznie (tylko jeśli puste/brak – istniejących nie zmieniamy)
random_hex() {
  if command -v openssl >/dev/null; then openssl rand -hex "$1"; else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}
ensure_key() { # $1 = nazwa, $2 = liczba bajtów, $3 = opis
  if grep -qE "^$1=\s*\S" .env; then
    info "$(m "$1 już ustawiony – pozostawiam bez zmian." "$1 is already set – leaving it unchanged.")"
    return
  fi
  local value
  value="$(random_hex "$2")"
  if grep -qE "^$1=" .env; then
    sed -i "s|^$1=.*|$1=${value}|" .env
  else
    printf '\n# %s\n%s=%s\n' "$3" "$1" "$value" >> .env
  fi
  info "$(m "Wygenerowano $1 i zapisano w .env." "Generated $1 and saved it in .env.")"
}
ensure_key N8N_ENCRYPTION_KEY 32 "$(m "Klucz szyfrujący poświadczenia n8n – NIGDY go nie zmieniaj po starcie" \
  "Key that encrypts n8n credentials – NEVER change it after the first start")"
ensure_key PANEL_INTERNAL_TOKEN 24 "$(m "Wspólny sekret panelu i n8n (generowany automatycznie)" "Shared secret of the panel and n8n (generated automatically)")"

# 3) Katalogi danych + uprawnienia dla użytkownika 'node' z kontenerów n8n i panelu (UID/GID 1000)
mkdir -p data/n8n data/files data/panel
chown -R "${N8N_UID}:${N8N_GID}" data
chmod -R u+rwX,g+rwX,o-rwx data
info "$(m "Katalogi data/n8n, data/files i data/panel należą do ${N8N_UID}:${N8N_GID} (chmod u+rwX,g+rwX)." \
  "The data/n8n, data/files and data/panel directories belong to ${N8N_UID}:${N8N_GID} (chmod u+rwX,g+rwX).")"

# Katalog projektu dla panelu – w kontenerze go nie zna, a pokazuje gotowe polecenia (np. przejście na PRO)
printf '{\n  "projectDir": "%s"\n}\n' "$(printf '%s' "$PROJECT_DIR" | sed 's/\\/\\\\/g; s/"/\\"/g')" >data/panel/install.json
chown "${N8N_UID}:${N8N_GID}" data/panel/install.json
chmod 640 data/panel/install.json

# 4) Szybka kontrola
ls -ln data
touch_test="data/n8n/.write-test"
if su -s /bin/sh -c "touch '$PROJECT_DIR/$touch_test'" "$(getent passwd ${N8N_UID} | cut -d: -f1)" 2>/dev/null; then
  rm -f "$touch_test"
  info "$(m "Test zapisu jako UID ${N8N_UID}: OK" "Write test as UID ${N8N_UID}: OK")"
else
  warn "$(m "Nie udało się przetestować zapisu jako UID ${N8N_UID} (brak takiego użytkownika na hoście – to normalne)." \
    "Could not test writing as UID ${N8N_UID} (no such user on the host – this is normal).")"
fi

NAS_IP_VAL="$(grep -E '^NAS_IP=' .env | tail -n1 | cut -d= -f2 || true)"
PANEL_PORT_VAL="$(grep -E '^PANEL_PORT=' .env | tail -n1 | cut -d= -f2 || true)"
N8N_PORT_VAL="$(grep -E '^N8N_PORT=' .env | tail -n1 | cut -d= -f2 || true)"
if [ "$UI_LANG" = en ]; then
  cat <<EOF

Done. Next:
  1. Check .env (NAS / server IP, time zone):   sudo nano .env
  2. Start the stack (also builds the panel):   sudo docker compose up -d --build
  3. n8n: http://${NAS_IP_VAL:-NAS_IP}:${N8N_PORT_VAL:-5678} → create the owner account right away, then:
                                                sudo bash scripts/import-to-n8n.sh
  4. Control panel: http://${NAS_IP_VAL:-NAS_IP}:${PANEL_PORT_VAL:-7080} → set the password, keys and bots.
     One-time code for the password:            sudo docker compose logs panel | grep -i code
EOF
else
  cat <<EOF

Gotowe. Dalej:
  1. Sprawdź .env (IP NAS-a, strefa czasowa):   sudo nano .env
  2. Uruchom stos (zbuduje też panel):          sudo docker compose up -d --build
  3. n8n: http://${NAS_IP_VAL:-IP_NAS}:${N8N_PORT_VAL:-5678} → od razu załóż konto właściciela, potem:
                                                sudo bash scripts/import-to-n8n.sh
  4. Panel sterowania: http://${NAS_IP_VAL:-IP_NAS}:${PANEL_PORT_VAL:-7080} → ustaw hasło, klucze i boty.
     Jednorazowy kod do ustawienia hasła:     sudo docker compose logs panel | grep -i kod
EOF
fi
