# shellcheck shell=bash disable=SC2034 # zmienne dla skryptów, które wczytują ten plik
# Licencja PRO – wspólne funkcje scripts/upgrade-to-pro.sh i scripts/update.sh (wczytywane po scripts/lang.sh):
#   . scripts/license.sh
# Logikę licencji (zapytania do Polara, stan w .git/poster-pro-license.json) ma panel/lib/license.js; skrypty
# uruchamiają ją obrazem panelu, więc na NAS-ie nie trzeba instalować Node.js.
# Próby, np. w piaskownicy Polara: zmienne POLAR_API_URL, POLAR_ORGANIZATION_ID i POSTER_PRO_REPO, np.
#   sudo POLAR_API_URL=https://sandbox-api.polar.sh POLAR_ORGANIZATION_ID=… bash scripts/upgrade-to-pro.sh

PRO_REPO="${POSTER_PRO_REPO:-git@github.com:imdangro/poster-pro.git}"
PRO_STATE=.git/poster-pro-license.json # klucz licencyjny i ID aktywacji (tylko root)
PRO_KEY=.git/poster-pro-key            # klucz SSH tego NAS-a do repozytorium PRO (tylko do odczytu)
PANEL_KEY=data/panel/license-key.json  # klucz licencyjny wklejony w panelu – czeka na upgrade-to-pro.sh
PANEL_IMAGE=poster-panel:local         # obraz panelu z docker-compose.yml – z niego Node.js

# Obraz panelu jest zbudowany przy instalacji; gdy go brak – budujemy
license_image() {
  docker image inspect "$PANEL_IMAGE" >/dev/null 2>&1 || docker compose build panel >/dev/null
}

# node panel/license-cli.js <polecenie> w kontenerze z obrazu panelu (standardowe wejście → klucz licencyjny)
license_cli() {
  docker run --rm -i --user 0 -v "$PWD":/w -w /w -e POLAR_API_URL -e POLAR_ORGANIZATION_ID -e POSTER_LANG="$UI_LANG" \
    --entrypoint node "$PANEL_IMAGE" panel/license-cli.js "$@"
}

# Wynik license-cli.js (linie klucz=wartość) → zmienne LIC_*
license_read() {
  LIC_RESULT=error LIC_STATUS='' LIC_UNTIL='' LIC_DAYS='' LIC_LIMIT='' LIC_RENEW='' LIC_PRODUCT='' LIC_DETAIL=''
  local k v
  while IFS='=' read -r k v; do
    case "$k" in
      result) LIC_RESULT="$v" ;;
      status) LIC_STATUS="$v" ;;
      updates_until) LIC_UNTIL="$v" ;;
      days_left) LIC_DAYS="$v" ;;
      limit) LIC_LIMIT="$v" ;;
      renew_url) LIC_RENEW="$v" ;;
      product_url) LIC_PRODUCT="$v" ;;
      detail) LIC_DETAIL="$v" ;;
    esac
  done <<<"$1"
}

# Data końca aktualizacji: 17.10.2027 (PL) albo 2027-10-17 (EN)
license_date() {
  local d="$LIC_UNTIL"
  if [ "$UI_LANG" = en ]; then printf '%s' "$d"; else printf '%s.%s.%s' "${d:8:2}" "${d:5:2}" "${d:0:4}"; fi
}

# „aktualizacje do 17.10.2027” / „bez limitu czasu” – puste, gdy data nie jest jeszcze znana
license_until() {
  if [ -n "$LIC_UNTIL" ]; then
    m "aktualizacje do $(license_date)" "updates until $(license_date)"
  elif [ "$LIC_STATUS" = granted ]; then
    m "aktualizacje bez limitu czasu" "updates with no end date"
  fi
}
