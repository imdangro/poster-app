#!/usr/bin/env bash
# Poster – instalacja jednym poleceniem (SSH na NAS-ie z UGOS albo serwerze Linux z Dockerem):
#   curl -fsSL https://posterapp.pl/install.sh | sudo bash
# Opcje: curl -fsSL https://posterapp.pl/install.sh | sudo bash -s -- --dir /opt/poster --lang en
#   --dir  katalog projektu (domyślnie <wolumin>/docker/poster na NAS-ie, na serwerze /opt/poster; też POSTER_DIR),
#   --lang język komunikatów: pl albo en (też POSTER_LANG; domyślnie z języka systemu i strefy czasowej).
# Kroki: 1) Docker i Docker Compose v2, 2) pobranie Postera (git w kontenerze alpine/git – bez instalowania gita),
#        3) scripts/init-nas.sh (.env, klucze, katalogi data/), a w nowym .env adres IP, strefa czasowa i wolne porty,
#        4) docker compose up -d --build, 5) konto właściciela n8n (losowe hasło) i scripts/import-to-n8n.sh,
#        6) adres panelu i jednorazowy kod do ustawienia hasła z logów panelu.
# Serwer z publicznym adresem IP: panel i n8n nasłuchują tylko na 127.0.0.1 (dostęp tunelem SSH – instrukcja na końcu).
# Ponowne uruchomienie dokończy przerwaną instalację, a gotowej nie zmienia – podpowiada scripts/update.sh.
# Testy: POSTER_REPO – inne repozytorium (adres albo katalog z klonem gita).
# Cała logika jest w funkcjach, a main startuje w ostatniej linii: bash przy „curl | bash” wykona skrypt dopiero po
# pobraniu całości, a polecenia nie czytają reszty skryptu ze standardowego wejścia.
set -euo pipefail

REPO="${POSTER_REPO:-https://github.com/imdangro/poster-app.git}"
PRODUCT_URL="https://posterapp.pl/"
N8N_EMAIL="admin@poster.local"
# kod z logów panelu (panel/lib/auth.js): XXXX-XXXX-XXXX bez znaków, które się mylą
CODE_CHARS='[ABCDEFGHJKMNPQRSTUVWXYZ23456789]'
CODE_RE="${CODE_CHARS}{4}-${CODE_CHARS}{4}-${CODE_CHARS}{4}"

UI_LANG=en
m() { if [ "$UI_LANG" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
info() { printf '\033[1;34m[poster]\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(m uwaga note)" "$*"; }
die() {
  printf '\033[1;31m[%s]\033[0m %s\n' "$(m błąd error)" "$*" >&2
  exit 1
}

# Strefa czasowa hosta (Region/Miasto) – pusta, gdy jej nie ma albo to UTC
host_tz() {
  local tz=""
  command -v timedatectl >/dev/null 2>&1 && tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  [ -n "$tz" ] || tz="$(cat /etc/timezone 2>/dev/null || true)"
  if [ -z "$tz" ]; then
    tz="$(readlink -f /etc/localtime 2>/dev/null || true)"
    case "$tz" in */zoneinfo/*) tz="${tz#*/zoneinfo/}" ;; *) tz="" ;; esac
  fi
  tz="${tz#posix/}"
  tz="${tz#right/}"
  case "$tz" in */*) ;; *) tz="" ;; esac
  case "$tz" in Etc/* | *[!A-Za-z0-9_/+-]*) tz="" ;; esac
  printf '%s' "$tz"
}

# Język: --lang / POSTER_LANG → język systemu (pl*) → strefa Europe/Warsaw → angielski
detect_lang() {
  case "$1" in pl | en) printf '%s' "$1" && return ;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in pl* | PL*) printf 'pl' && return ;; esac
  [ "$(host_tz)" = Europe/Warsaw ] && printf 'pl' && return
  printf 'en'
}

usage() {
  if [ "$UI_LANG" = en ]; then
    cat <<'EOF'
Poster – installation with one command (NAS or Linux server with Docker):
  curl -fsSL https://posterapp.pl/install.sh | sudo bash
Options (after "sudo bash -s --"):
  --dir <directory>   project directory (default <volume>/docker/poster on a NAS, /opt/poster on a server)
  --lang pl|en        language of the messages
EOF
  else
    cat <<'EOF'
Poster – instalacja jednym poleceniem (NAS albo serwer Linux z Dockerem):
  curl -fsSL https://posterapp.pl/install.sh | sudo bash
Opcje (po „sudo bash -s --”):
  --dir <katalog>     katalog projektu (domyślnie <wolumin>/docker/poster na NAS-ie, /opt/poster na serwerze)
  --lang pl|en        język komunikatów
EOF
  fi
}

# Katalog domyślny: folder docker na woluminie NAS-a (UGOS: /volume1/docker), na serwerze /opt
default_dir() {
  local d
  for d in /volume*/docker; do
    [ -d "$d" ] && printf '%s/poster' "$d" && return
  done
  if [ -d /volume1 ]; then printf '/volume1/docker/poster'; else printf '/opt/poster'; fi
}

is_poster_dir() { [ -f "$1/docker-compose.yml" ] && [ -f "$1/scripts/init-nas.sh" ] && [ -f "$1/panel/server.js" ]; }
# Hasło panelu ustawione (panel/lib/auth.js: auth.json z polem hash) = instalacja gotowa
panel_ready() { grep -qs '"hash"' "$1/data/panel/auth.json"; }

env_get() {
  local line
  line="$(grep -E "^$1=" .env 2>/dev/null | tail -n1 || true)"
  line="${line#*=}"
  printf '%s' "${line%$'\r'}"
}
env_set() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >>.env; fi
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"; else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# Adres IPv4 hosta, przez który wychodzi ruch do internetu (w domu: adres NAS-a w sieci lokalnej)
host_ip() {
  local ip=""
  command -v ip >/dev/null 2>&1 && ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1 || true)"
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -vE '^(127|172\.17)\.' | head -n1 || true)"
  fi
  printf '%s' "$ip"
}

# Adres prywatny (sieć lokalna, CGNAT, Tailscale) – panel może nasłuchiwać na wszystkich adresach
is_private_ip() {
  case "$1" in
    10.* | 192.168.* | 127.* | 169.254.*) return 0 ;;
    172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) return 0 ;;
    100.6[4-9].* | 100.[7-9][0-9].* | 100.1[01][0-9].* | 100.12[0-7].*) return 0 ;;
  esac
  return 1
}

port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$1" 2>/dev/null | tail -n +2 | grep -q .
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  else
    return 1
  fi
}
free_port() {
  local p
  for p in $(seq "$1" $(($1 + 49))); do
    port_busy "$p" || { printf '%s' "$p" && return; }
  done
  printf '%s' "$1"
}

check_docker() {
  command -v docker >/dev/null 2>&1 || die "$(m "Brak Dockera. NAS z UGOS: App Center → Docker. Serwer Linux: https://docs.docker.com/engine/install/" \
    "Docker is missing. NAS with UGOS: App Center → Docker. Linux server: https://docs.docker.com/engine/install/")"
  docker info >/dev/null 2>&1 || die "$(m "Docker nie działa. NAS z UGOS: otwórz aplikację Docker. Serwer Linux: sudo systemctl start docker" \
    "Docker is not running. NAS with UGOS: open the Docker app. Linux server: sudo systemctl start docker")"
  docker compose version >/dev/null 2>&1 || die "$(m "Brak 'docker compose' (v2). NAS z UGOS: zaktualizuj aplikację Docker. Serwer Linux: zainstaluj wtyczkę docker-compose-plugin." \
    "'docker compose' (v2) is missing. NAS with UGOS: update the Docker app. Linux server: install the docker-compose-plugin package.")"
  case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) die "$(m "n8n działa tylko na procesorach 64-bitowych (x86-64 albo ARM64), a ten ma architekturę $(uname -m)." \
      "n8n runs only on 64-bit processors (x86-64 or ARM64), this one is $(uname -m).")" ;;
  esac
  # obrazy n8n, RSSHub i panelu zajmują ok. 3 GB w katalogu Dockera
  local root free
  root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)"
  free="$(df -Pk "${root:-/}" 2>/dev/null | awk 'NR == 2 {print $4}' || true)"
  if [ -n "$free" ] && [ "$free" -lt 4000000 ]; then
    warn "$(m "Na dysku Dockera (${root:-/}) zostało mniej niż 4 GB – obrazy zajmą ok. 3 GB." \
      "Less than 4 GB left on the Docker disk (${root:-/}) – the images take about 3 GB.")"
  fi
}

clone_repo() {
  local parent name repo="$REPO" src=()
  parent="$(dirname "$DIR")"
  name="$(basename "$DIR")"
  mkdir -p "$parent"
  # repozytorium z katalogu (testy): klon z kopii zamontowanej tylko do odczytu
  if [ -d "$repo" ]; then
    src=(-v "$(cd "$repo" && pwd):/src:ro")
    repo=/src
  fi
  info "$(m "Pobieram Postera do $DIR..." "Downloading Poster to $DIR...")"
  docker run --rm ${src[@]+"${src[@]}"} -v "$parent":/git alpine/git -c safe.directory='*' -c advice.detachedHead=false clone --quiet "$repo" "$name" ||
    die "$(m "Nie udało się pobrać Postera (komunikat gita powyżej). Sprawdź połączenie z internetem i uruchom instalator ponownie." \
      "Could not download Poster (git message above). Check the internet connection and run the installer again.")"
  if ! is_poster_dir "$DIR"; then
    rm -rf -- "$DIR"
    die "$(m "W repozytorium nie ma jeszcze programu – wersja LITE nie została wydana. Szczegóły: $PRODUCT_URL" \
      "The repository does not contain the program yet – Poster LITE has not been released. Details: $PRODUCT_URL")"
  fi
}

# Nowy .env: adres hosta, strefa czasowa i wolne porty (istniejącego .env instalator nie zmienia)
configure_env() {
  local ip tz var port want
  ip="$(host_ip)"
  if [ -z "$ip" ]; then
    warn "$(m "Nie rozpoznałem adresu IP – wpisz go w .env (NAS_IP) i uruchom: sudo docker compose up -d" \
      "Could not detect the IP address – enter it in .env (NAS_IP) and run: sudo docker compose up -d")"
  elif is_private_ip "$ip"; then
    env_set NAS_IP "$ip"
    info "$(m "Adres w sieci lokalnej: $ip" "Local network address: $ip")"
  else
    # publiczny adres (serwer w internecie): panel i n8n tylko na 127.0.0.1, dostęp tunelem SSH
    env_set NAS_IP localhost
    env_set BIND_ADDRESS 127.0.0.1
    info "$(m "Publiczny adres $ip: panel i n8n będą dostępne tylko przez tunel SSH (instrukcja na końcu)." \
      "Public address $ip: the panel and n8n will be reachable only through an SSH tunnel (instructions at the end).")"
  fi
  tz="$(host_tz)"
  if [ -n "$tz" ] && [ "$tz" != "$(env_get TZ)" ]; then
    env_set TZ "$tz"
    info "$(m "Strefa czasowa: $tz" "Time zone: $tz")"
  fi
  for var in PANEL_PORT N8N_PORT; do
    port="$(env_get "$var")"
    [ -n "$port" ] || continue
    want="$(free_port "$port")"
    if [ "$want" != "$port" ]; then
      env_set "$var" "$want"
      info "$(m "Port $port jest zajęty – $var=$want" "Port $port is in use – $var=$want")"
    fi
  done
}

n8n_ready() {
  docker compose exec -T n8n node -e \
    "fetch('http://127.0.0.1:5678/healthz/readiness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    </dev/null >/dev/null 2>&1
}
wait_n8n() {
  local i
  for i in $(seq 1 60); do
    n8n_ready && return 0
    sleep 3
  done
  return 1
}

# Konto właściciela n8n (to samo co pierwszy ekran n8n): bez niego każdy w sieci mógłby przejąć n8n.
# Wynik: created | exists | error …
n8n_owner() {
  printf '{"email":"%s","firstName":"Poster","lastName":"Admin","password":"%s"}' "$N8N_EMAIL" "$1" |
    docker compose exec -T n8n node -e '
let body = "";
process.stdin.on("data", (d) => (body += d)).on("end", async () => {
  try {
    const r = await fetch("http://127.0.0.1:5678/rest/owner/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const text = await r.text();
    console.log(r.ok ? "created" : /already/i.test(text) ? "exists" : `error HTTP ${r.status}`);
  } catch (e) {
    console.log(`error ${e.message}`);
  }
});' 2>/dev/null || echo "error exec"
}

panel_code() {
  docker compose logs --no-color panel 2>/dev/null | grep -aE 'Panel setup code|Kod do ustawienia' |
    LC_ALL=C grep -aoE "$CODE_RE" | tail -n1 || true
}

already_installed() {
  local port
  port="$(cd "$1" && env_get PANEL_PORT)"
  step "$(m "Poster jest już zainstalowany w $1." "Poster is already installed in $1.")"
  if [ "$UI_LANG" = en ]; then
    cat <<EOF
  Panel:   http://$(cd "$1" && env_get NAS_IP):${port:-7080}
  Update:  sudo bash $1/scripts/update.sh
EOF
  else
    cat <<EOF
  Panel:         http://$(cd "$1" && env_get NAS_IP):${port:-7080}
  Aktualizacja:  sudo bash $1/scripts/update.sh
EOF
  fi
}

summary() {
  local ip panel_port n8n_port host code tunnel=""
  panel_port="$(env_get PANEL_PORT)"
  panel_port="${panel_port:-7080}"
  n8n_port="$(env_get N8N_PORT)"
  n8n_port="${n8n_port:-5678}"
  host="$(env_get NAS_IP)"
  if [ "$(env_get BIND_ADDRESS)" = 127.0.0.1 ]; then
    ip="$(host_ip)"
    tunnel="ssh -L ${panel_port}:127.0.0.1:${panel_port} -L ${n8n_port}:127.0.0.1:${n8n_port} ${SUDO_USER:-root}@${ip:-$(m adres_serwera server_address)}"
    host=localhost
  fi
  code="$1"
  local minutes=$(((SECONDS + 59) / 60))
  if [ "$UI_LANG" = en ]; then
    printf '\n\033[1;32m✅ Poster is running\033[0m (installation: %s min).\n\n' "$minutes"
    [ -z "$tunnel" ] || printf '  Server on the internet – connect from your computer through an SSH tunnel:\n    %s\n\n' "$tunnel"
    printf '  Control panel:   http://%s:%s\n' "$host" "$panel_port"
    if [ -n "$code" ]; then
      printf '  One-time code:   \033[1m%s\033[0m  – enter it in the panel together with your new password\n' "$code"
    else
      printf '  One-time code:   cd %s && sudo docker compose logs panel | grep -i code\n' "$DIR"
    fi
    printf '\n  Next, in the panel: password and language → Settings: Gemini key and Telegram bot → your bot: topic, sources, “Run now”.\n\n'
    printf '  n8n (workflow engine – you set everything in the panel): http://%s:%s\n' "$host" "$n8n_port"
    if [ -n "$N8N_PASS" ]; then
      printf '    login: %s   password: \033[1m%s\033[0m  – save it, the installer shows it only once\n' "$N8N_EMAIL" "$N8N_PASS"
    fi
    printf '\n  Project directory: %s\n' "$DIR"
    printf '  Update:            sudo bash %s/scripts/update.sh\n' "$DIR"
    printf '  PRO edition:       after buying a license (%s) paste the key in the panel: Settings → PRO edition\n' "$PRODUCT_URL"
  else
    printf '\n\033[1;32m✅ Poster działa\033[0m (instalacja: %s min).\n\n' "$minutes"
    [ -z "$tunnel" ] || printf '  Serwer w internecie – połącz się ze swojego komputera tunelem SSH:\n    %s\n\n' "$tunnel"
    printf '  Panel sterowania:  http://%s:%s\n' "$host" "$panel_port"
    if [ -n "$code" ]; then
      printf '  Jednorazowy kod:   \033[1m%s\033[0m  – wpisz go w panelu razem z nowym hasłem\n' "$code"
    else
      printf '  Jednorazowy kod:   cd %s && sudo docker compose logs panel | grep -i kod\n' "$DIR"
    fi
    printf '\n  Dalej w panelu: hasło i język → Ustawienia: klucz Gemini i bot Telegram → bot: temat, źródła, „Uruchom teraz”.\n\n'
    printf '  n8n (silnik workflow – wszystko ustawiasz w panelu): http://%s:%s\n' "$host" "$n8n_port"
    if [ -n "$N8N_PASS" ]; then
      printf '    login: %s   hasło: \033[1m%s\033[0m  – zapisz je, instalator pokazuje je tylko raz\n' "$N8N_EMAIL" "$N8N_PASS"
    fi
    printf '\n  Katalog projektu:  %s\n' "$DIR"
    printf '  Aktualizacja:      sudo bash %s/scripts/update.sh\n' "$DIR"
    printf '  Wersja PRO:        po zakupie licencji (%s) wklej klucz w panelu: Ustawienia → Wersja PRO\n' "$PRODUCT_URL"
  fi
}

main() {
  # polecenia nie mogą czytać ze standardowego wejścia – przy „curl | bash” to jest sam skrypt
  exec </dev/null
  local arg i lang="${POSTER_LANG:-}" args=("$@")
  DIR="${POSTER_DIR:-}"
  N8N_PASS=""
  for arg in "$@"; do
    case "$arg" in --lang=*) lang="${arg#--lang=}" ;; esac
  done
  for ((i = 0; i < ${#args[@]}; i++)); do
    [ "${args[$i]}" = --lang ] && lang="${args[$((i + 1))]:-}"
  done
  UI_LANG="$(detect_lang "$lang")"
  export POSTER_LANG="$UI_LANG" # skrypty z scripts/ mówią tym samym językiem
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir)
        [ $# -ge 2 ] || die "$(m "Podaj katalog: --dir /ścieżka" "Give a directory: --dir /path")"
        DIR="$2"
        shift 2
        ;;
      --dir=*) DIR="${1#--dir=}" && shift ;;
      --lang) shift 2 || shift ;;
      --lang=*) shift ;;
      -h | --help) usage && exit 0 ;;
      *) die "$(m "Nieznana opcja: $1" "Unknown option: $1")" ;;
    esac
  done
  [ "$(id -u)" -eq 0 ] || die "$(m "Uruchom przez sudo: curl -fsSL https://posterapp.pl/install.sh | sudo bash" \
    "Run it with sudo: curl -fsSL https://posterapp.pl/install.sh | sudo bash")"

  step "$(m "Poster – instalacja ($PRODUCT_URL)" "Poster – installation ($PRODUCT_URL)")"
  step "1/6 Docker"
  check_docker
  info "$(m "Docker i Docker Compose v2: OK" "Docker and Docker Compose v2: OK")"

  # Działające już kontenery Postera (np. z innego katalogu) – nazwy kontenerów są stałe
  local running
  running="$(docker container inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' poster-panel 2>/dev/null || true)"
  if [ -n "$running" ]; then
    is_poster_dir "$running" || die "$(m "Istnieją kontenery Postera z usuniętego katalogu $running. Usuń je i uruchom instalator ponownie: sudo docker rm -f poster-panel poster-n8n poster-rsshub" \
      "Poster containers from the removed directory $running still exist. Remove them and run the installer again: sudo docker rm -f poster-panel poster-n8n poster-rsshub")"
    if [ -z "$DIR" ]; then
      DIR="$running"
    elif [ "$(cd "$DIR" 2>/dev/null && pwd -P)" != "$(cd "$running" && pwd -P)" ]; then
      die "$(m "Poster działa już w katalogu $running – aktualizacja: sudo bash $running/scripts/update.sh" \
        "Poster is already running in $running – update: sudo bash $running/scripts/update.sh")"
    fi
  fi
  [ -n "$DIR" ] || DIR="$(default_dir)"
  case "$DIR" in /*) ;; *) DIR="$PWD/$DIR" ;; esac
  DIR="${DIR%/}"
  [ -n "$DIR" ] && [ "$DIR" != / ] || die "$(m "Nieprawidłowy katalog projektu." "Invalid project directory.")"

  if is_poster_dir "$DIR" && panel_ready "$DIR"; then
    already_installed "$DIR"
    exit 0
  fi

  step "$(m "2/6 Pobieranie" "2/6 Download")"
  if is_poster_dir "$DIR"; then
    info "$(m "Poster jest już w $DIR – dokańczam instalację." "Poster is already in $DIR – finishing the installation.")"
  elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    die "$(m "Katalog $DIR istnieje i nie jest pusty. Wybierz inny: … | sudo bash -s -- --dir /inny/katalog" \
      "The directory $DIR exists and is not empty. Choose another one: … | sudo bash -s -- --dir /other/directory")"
  else
    clone_repo
  fi
  cd "$DIR"

  step "$(m "3/6 Konfiguracja" "3/6 Configuration")"
  local new_env=0
  [ -f .env ] || new_env=1
  bash scripts/init-nas.sh >/dev/null || die "$(m "scripts/init-nas.sh się nie powiódł (komunikat powyżej)." "scripts/init-nas.sh failed (message above).")"
  if [ "$new_env" -eq 1 ]; then
    configure_env
  else
    info "$(m "Plik .env już istnieje – zostawiam go bez zmian." "The .env file already exists – leaving it unchanged.")"
  fi
  info "$(m ".env i klucze: OK (sudo nano $DIR/.env)" ".env and keys: OK (sudo nano $DIR/.env)")"

  step "$(m "4/6 Uruchamianie kontenerów – za pierwszym razem pobiera ok. 1 GB, zwykle 3–15 min" \
    "4/6 Starting the containers – the first time downloads about 1 GB, usually 3–15 min")"
  docker compose up -d --build || die "$(m "Nie udało się uruchomić kontenerów (komunikat powyżej). Po usunięciu przyczyny uruchom instalator ponownie – dokończy instalację." \
    "Could not start the containers (message above). After fixing the cause run the installer again – it finishes the installation.")"

  step "$(m "5/6 n8n: konto właściciela i workflow" "5/6 n8n: owner account and workflow")"
  info "$(m "Czekam na n8n..." "Waiting for n8n...")"
  wait_n8n || die "$(m "n8n nie odpowiada – sprawdź: cd $DIR && sudo docker compose logs n8n" \
    "n8n is not responding – check: cd $DIR && sudo docker compose logs n8n")"
  local pass result
  pass="Pn8-$(random_hex 4)-$(random_hex 4)"
  result="$(n8n_owner "$pass")"
  case "$result" in
    created)
      N8N_PASS="$pass"
      info "$(m "Konto właściciela n8n założone (login i hasło na końcu)." "n8n owner account created (login and password at the end).")"
      ;;
    exists) info "$(m "Konto właściciela n8n już istnieje." "The n8n owner account already exists.")" ;;
    *) warn "$(m "Nie udało się założyć konta n8n ($result) – załóż je od razu w n8n (port $(env_get N8N_PORT))." \
      "Could not create the n8n account ($result) – create it right away in n8n (port $(env_get N8N_PORT)).")" ;;
  esac
  info "$(m "Importuję i publikuję workflow..." "Importing and publishing the workflow...")"
  bash scripts/import-to-n8n.sh >/dev/null || die "$(m "Import workflow się nie powiódł (komunikat powyżej). Ponów: sudo bash $DIR/scripts/import-to-n8n.sh" \
    "The workflow import failed (message above). Retry: sudo bash $DIR/scripts/import-to-n8n.sh")"
  wait_n8n || warn "$(m "n8n jeszcze startuje – sprawdź za chwilę: cd $DIR && sudo docker compose ps" \
    "n8n is still starting – check in a moment: cd $DIR && sudo docker compose ps")"
  info "$(m "Workflow działa 24/7." "The workflow runs 24/7.")"

  step "6/6 Panel"
  local code=""
  for i in $(seq 1 30); do
    panel_ready "$DIR" && break
    code="$(panel_code)"
    [ -n "$code" ] && break
    sleep 2
  done
  if [ -z "$code" ] && ! panel_ready "$DIR"; then
    warn "$(m "Panel nie pokazał kodu – sprawdź jego logi: cd $DIR && sudo docker compose logs panel" \
      "The panel did not show the code – check its logs: cd $DIR && sudo docker compose logs panel")"
  fi
  summary "$code"
}

main "$@"
