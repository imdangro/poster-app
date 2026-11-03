#!/usr/bin/env bash
# Importuje workflow Poster do n8n i go publikuje (aktywuje 24/7). Klucze API i konta botów ustawiasz w panelu
# (http://IP_NAS:7080), a n8n woła API przez bramkę panelu. Jedyne poświadczenie n8n – „Poster: token panelu” dla
# webhooka zleceń (nagłówek x-poster-token = PANEL_INTERNAL_TOKEN) – skrypt tworzy sam, tak jak konto właściciela n8n,
# gdy go jeszcze nie ma (instalacja ręczna; bez konta każdy w sieci mógłby je założyć i przejąć n8n).
#
# Użycie (SSH, katalog projektu, kontenery uruchomione):
#   sudo bash scripts/import-to-n8n.sh                 # import + publikacja + restart n8n (zalecane)
#   sudo bash scripts/import-to-n8n.sh --no-publish    # tylko import (opublikujesz w UI przyciskiem Publish)
#   sudo bash scripts/import-to-n8n.sh --only-publish  # tylko publikacja + restart (bez importu)
# UWAGA: import nadpisuje zmiany zrobione ręcznie w tym workflow w UI n8n.
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lang.sh

DO_WORKFLOW=1
PUBLISH=1
for arg in "$@"; do
  case "$arg" in
    --no-publish) PUBLISH=0 ;;
    --only-publish) DO_WORKFLOW=0 ;;
    *) echo "$(m "Nieznana opcja: $arg" "Unknown option: $arg")" >&2; exit 2 ;;
  esac
done

info() { printf '\033[1;34m[import]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(m uwaga note)" "$*" >&2; }
die() { printf '\033[1;31m[%s]\033[0m %s\n' "$(m błąd error)" "$*" >&2; exit 1; }

[ -f .env ] || die "$(m "Brak pliku .env – uruchom najpierw: sudo bash scripts/init-nas.sh" "No .env file – first run: sudo bash scripts/init-nas.sh")"
get_env() {
  local line
  line="$(grep -E "^$1=" .env | tail -n1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  printf '%s' "$line"
}

docker compose ps --status running --services 2>/dev/null | grep -qx n8n \
  || die "$(m "Kontener n8n nie działa. Uruchom: sudo docker compose up -d --build" "The n8n container is not running. Start it: sudo docker compose up -d --build")"

info "$(m "Czekam, aż n8n będzie gotowy (healthz/readiness)..." "Waiting for n8n to be ready (healthz/readiness)...")"
for i in $(seq 1 40); do
  if docker compose exec -T n8n node -e "fetch('http://127.0.0.1:5678/healthz/readiness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  [ "$i" -eq 40 ] && die "$(m "n8n nie odpowiada – sprawdź: sudo docker compose logs n8n" "n8n is not responding – check: sudo docker compose logs n8n")"
  sleep 3
done

# Konto właściciela n8n (to samo co pierwszy ekran n8n). Instalator jednym poleceniem zakłada je sam (kolejna próba
# kończy się „exists”); tu – instalacja ręczna i starsze instalacje bez konta. Login i hasło idą na stderr: instalator
# ukrywa resztę komunikatów tego skryptu, a hasła nie widać nigdzie indziej.
N8N_EMAIL="admin@poster.local"
random_hex() {
  if command -v openssl >/dev/null; then openssl rand -hex "$1"; else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}
n8n_owner() { # $1 = hasło; wynik: created | exists | error …
  printf '{"email":"%s","firstName":"Poster","lastName":"Admin","password":"%s"}' "$N8N_EMAIL" "$1" |
    docker compose exec -T n8n node -e '
let body = "";
process.stdin.on("data", (d) => (body += d)).on("end", async () => {
  try {
    const r = await fetch("http://127.0.0.1:5678/rest/owner/setup", { method: "POST", headers: { "content-type": "application/json" }, body });
    const text = await r.text();
    console.log(r.ok ? "created" : /already/i.test(text) ? "exists" : `error HTTP ${r.status}`);
  } catch (e) {
    console.log(`error ${e.message}`);
  }
});' 2>/dev/null || echo "error exec"
}
N8N_PASS="Pn8-$(random_hex 4)-$(random_hex 4)"
case "$(n8n_owner "$N8N_PASS")" in
  created)
    printf '\n\033[1;33m%s\033[0m\n  %s: %s\n  %s: \033[1m%s\033[0m\n\n' \
      "$(m "Konto właściciela n8n założone – zapisz login i hasło, skrypt pokazuje je tylko raz:" \
        "n8n owner account created – save the login and password, the script shows them only once:")" \
      login "$N8N_EMAIL" "$(m hasło password)" "$N8N_PASS" >&2
    ;;
  exists) ;;
  *) warn "$(m "Nie udało się sprawdzić konta właściciela n8n – jeśli n8n pokazuje ekran zakładania konta, załóż je od razu." \
    "Could not check the n8n owner account – if n8n shows the account setup screen, create the account right away.")" ;;
esac

if [ "$DO_WORKFLOW" -eq 1 ]; then
  # Webhook zleceń przyjmuje tylko zapytania z tokenem panelu (Header Auth n8n). Poświadczenie powstaje w kontenerze
  # n8n z jego własnej zmiennej PANEL_INTERNAL_TOKEN (token nie przechodzi przez ten skrypt); n8n szyfruje je przy
  # imporcie, a ten sam identyfikator przy każdej aktualizacji nadpisuje poprzednią wersję (np. po zmianie tokenu).
  info "$(m "Tworzę poświadczenie webhooka (token panelu)..." "Creating the webhook credential (panel token)...")"
  docker compose exec -T n8n sh -c 'umask 077; f=/tmp/poster-credential.json
printf "[{\"id\":\"PosterPanelToken\",\"name\":\"Poster: token panelu\",\"type\":\"httpHeaderAuth\",\"data\":{\"name\":\"x-poster-token\",\"value\":\"%s\"}}]" "$PANEL_INTERNAL_TOKEN" >"$f" &&
n8n import:credentials --input="$f"; rc=$?; rm -f "$f"; exit $rc' </dev/null
  info "$(m "Importuję workflow..." "Importing the workflow...")"
  # Plik czyta host (root) i przekazuje go przez stdin – niezależnie od uprawnień/ACL udziału NAS-a,
  # których użytkownik kontenera (UID 1000) mógłby nie mieć.
  docker compose exec -T n8n sh -c \
    'umask 077; f=/tmp/poster-workflow.json; cat > "$f" && n8n import:workflow --input="$f"; rc=$?; rm -f "$f"; exit $rc' \
    < workflows/poster_workflow.json
fi

if [ "$PUBLISH" -eq 1 ]; then
  info "$(m "Publikuję workflow (aktywacja 24/7) i restartuję n8n..." "Publishing the workflow (24/7 activation) and restarting n8n...")"
  docker compose exec -T n8n n8n publish:workflow --id=PosterBotMain001
  docker compose restart n8n
fi

NAS_IP="$(get_env NAS_IP)"
PANEL_URL="http://${NAS_IP:-IP_NAS}:$(get_env PANEL_PORT | grep . || echo 7080)"
if [ "$UI_LANG" = en ]; then
  cat <<EOF

Done. From now on you set everything in the panel: ${PANEL_URL/IP_NAS/NAS_IP}
  • Settings: Gemini key, Telegram bot token + chat ID (the “Detect” button), X / TikTok apps.
  • Bot: topic, sources, schedule, platforms; the Accounts tab – X, Facebook/Instagram, TikTok.
  • “Run now” – the first draft arrives in Telegram in about 1–2 min.
EOF
else
  cat <<EOF

Gotowe. Dalej wszystko ustawiasz w panelu: ${PANEL_URL}
  • Ustawienia: klucz Gemini, token bota Telegram + ID czatu (przycisk „Wykryj”), aplikacje X / TikTok.
  • Bot: temat, źródła, harmonogram, platformy; zakładka Konta – X, Facebook/Instagram, TikTok.
  • „Uruchom teraz” – pierwszy draft pojawi się w Telegramie po ok. 1–2 min.
EOF
fi
