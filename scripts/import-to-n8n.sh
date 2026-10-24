#!/usr/bin/env bash
# Importuje workflow Poster do n8n i go publikuje (aktywuje 24/7). Workflow nie potrzebuje żadnych
# poświadczeń n8n – klucze API i konta botów ustawiasz w panelu (http://IP_NAS:7080), a n8n woła API
# przez bramkę panelu.
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
    --publish | --only-workflow) ;; # zgodność ze starszą wersją skryptu
    --only-credentials | --force-x)
      echo "$(m "Opcja $arg nie jest już potrzebna – klucze i konta ustawiasz w panelu (port 7080)." \
        "The $arg option is no longer needed – you set keys and accounts in the panel (port 7080).")" >&2
      exit 0
      ;;
    *) echo "$(m "Nieznana opcja: $arg" "Unknown option: $arg")" >&2; exit 2 ;;
  esac
done

info() { printf '\033[1;34m[import]\033[0m %s\n' "$*"; }
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

if [ "$DO_WORKFLOW" -eq 1 ]; then
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
