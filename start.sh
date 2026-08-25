#!/usr/bin/env bash
# BBterminal — launch both servers and open the browser.
# Idempotent: if a server is already running on its port, it's left alone.

set -euo pipefail
cd "$(dirname "$0")"

AMBER="\033[33m"; GREEN="\033[32m"; RED="\033[31m"; DIM="\033[2m"; RST="\033[0m"
step() { printf "${AMBER}▸ %s${RST}\n" "$*"; }
ok()   { printf "${GREEN}✓ %s${RST}\n" "$*"; }
fail() { printf "${RED}✗ %s${RST}\n" "$*" >&2; exit 1; }

API_PORT=6900
QUANT_PORT=6901
UI_PORT=5173

[ -x .venv/bin/openbb-api ] || fail "Run ./setup.sh first (OpenBB is not installed)."
[ -d app/node_modules ] || fail "Run ./setup.sh first (UI deps not installed)."

port_in_use() { lsof -ti tcp:"$1" >/dev/null 2>&1; }

# -------- API --------
if port_in_use "$API_PORT"; then
  ok "OpenBB API already running on :$API_PORT"
else
  step "Starting OpenBB API on :$API_PORT"
  nohup .venv/bin/openbb-api --host 127.0.0.1 --port "$API_PORT" \
    > /tmp/bbterminal-api.log 2>&1 &
  API_PID=$!
  printf "  ${DIM}waiting for API to come up"
  for i in $(seq 1 60); do
    if curl -s -o /dev/null "http://127.0.0.1:$API_PORT/openapi.json"; then
      printf "${RST}\n"; ok "OpenBB API up (pid $API_PID)"; break
    fi
    printf "."; sleep 1
    if [ "$i" = "60" ]; then
      printf "${RST}\n"
      fail "API didn't respond within 60s. See /tmp/bbterminal-api.log"
    fi
  done
fi

# -------- Quant service --------
if port_in_use "$QUANT_PORT"; then
  ok "Quant service already running on :$QUANT_PORT"
else
  step "Starting Quant service on :$QUANT_PORT"
  nohup .venv/bin/python quant_service/main.py \
    > /tmp/bbterminal-quant.log 2>&1 &
  QUANT_PID=$!
  printf "  ${DIM}waiting for Quant service"
  for i in $(seq 1 30); do
    if curl -s -o /dev/null "http://127.0.0.1:$QUANT_PORT/health"; then
      printf "${RST}\n"; ok "Quant service up (pid $QUANT_PID)"; break
    fi
    printf "."; sleep 1
    if [ "$i" = "30" ]; then
      printf "${RST}\n"
      fail "Quant service didn't respond within 30s. See /tmp/bbterminal-quant.log"
    fi
  done
fi

# -------- UI --------
if port_in_use "$UI_PORT"; then
  ok "UI dev server already running on :$UI_PORT"
else
  step "Starting UI on :$UI_PORT"
  ( cd app && nohup npm run dev > /tmp/bbterminal-ui.log 2>&1 & )
  printf "  ${DIM}waiting for UI"
  for i in $(seq 1 30); do
    if curl -s -o /dev/null "http://127.0.0.1:$UI_PORT/"; then
      printf "${RST}\n"; ok "UI up"; break
    fi
    printf "."; sleep 1
    if [ "$i" = "30" ]; then
      printf "${RST}\n"
      fail "UI didn't respond within 30s. See /tmp/bbterminal-ui.log"
    fi
  done
fi

# -------- Open browser --------
sleep 1
URL="http://localhost:$UI_PORT/"
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
fi

cat <<EOF

${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}
${AMBER}  BBterminal is live${RST}

  UI:         ${AMBER}${URL}${RST}
  API docs:   ${DIM}http://localhost:${API_PORT}/docs${RST}
  Quant docs: ${DIM}http://localhost:${QUANT_PORT}/docs${RST}

  Logs:       /tmp/bbterminal-api.log
              /tmp/bbterminal-quant.log
              /tmp/bbterminal-ui.log

  Stop:       ${AMBER}./stop.sh${RST}
${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}
EOF
