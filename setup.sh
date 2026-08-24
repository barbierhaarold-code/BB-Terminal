#!/usr/bin/env bash
# BBterminal — one-time setup
# Installs OpenBB Platform (Python) and the UI (Node). Run once.

set -euo pipefail
cd "$(dirname "$0")"

ROOT="$(pwd)"
AMBER="\033[33m"; GREEN="\033[32m"; RED="\033[31m"; DIM="\033[2m"; RST="\033[0m"

step() { printf "${AMBER}▸ %s${RST}\n" "$*"; }
ok()   { printf "${GREEN}✓ %s${RST}\n" "$*"; }
fail() { printf "${RED}✗ %s${RST}\n" "$*" >&2; exit 1; }

step "Checking prerequisites"

# Python 3.10-3.12 — prefer 3.12
PY=""
for cand in python3.12 python3.11 python3.10; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
[ -n "$PY" ] || fail "Python 3.10, 3.11, or 3.12 is required (install with: brew install python@3.12)"
ok "Python: $($PY --version)"

command -v node >/dev/null 2>&1 || fail "Node.js 18+ is required (install with: brew install node)"
ok "Node:   $(node --version)"

command -v npm >/dev/null 2>&1 || fail "npm is required"
ok "npm:    $(npm --version)"

# -------- Python venv + OpenBB --------
step "Creating Python virtual environment (.venv)"
if [ ! -d .venv ]; then
  "$PY" -m venv .venv
  ok "Created .venv with $PY"
else
  ok ".venv already exists"
fi

step "Upgrading pip"
.venv/bin/pip install --upgrade --quiet pip wheel

step "Installing OpenBB Platform (this takes ~3 minutes)"
# openbb-yfinance is pinned: patches/openbb_yfinance-1.6.3-options-chains-retry.patch
# (applied below) targets this exact version's options_chains.py. An
# unpinned upgrade could silently reintroduce the crash it fixes (Yahoo's
# transient crumb/session failures turning into an unguarded NoneType crash
# instead of a clean retry) or make the patch fail to apply. Bump both
# together — see patches/README.md.
.venv/bin/pip install --quiet "openbb[all]" openbb-cli "openbb-yfinance==1.6.3"
ok "OpenBB + all provider extensions installed"

step "Applying reliability patch to openbb-yfinance (Yahoo crumb retry)"
SITE_PKGS="$(.venv/bin/python -c 'import openbb_yfinance, os; print(os.path.dirname(os.path.dirname(openbb_yfinance.__file__)))')"
TARGET_FILE="$SITE_PKGS/openbb_yfinance/models/options_chains.py"
PATCH_FILE="$ROOT/patches/openbb_yfinance-1.6.3-options-chains-retry.patch"
if [ ! -f "$TARGET_FILE" ]; then
  fail "openbb_yfinance/models/options_chains.py not found under $SITE_PKGS — install layout may have changed, patch needs updating"
elif grep -q "_fetch_chain_with_retry" "$TARGET_FILE"; then
  ok "Retry patch already applied"
else
  patch -p1 -d "$SITE_PKGS" < "$PATCH_FILE" \
    && ok "Applied openbb-yfinance crumb-retry patch" \
    || fail "Failed to apply openbb-yfinance patch (see $PATCH_FILE) — options chain endpoint will crash on Yahoo's transient crumb errors without it"
fi

# -------- UI dependencies --------
step "Installing UI dependencies"
( cd "$ROOT/app" && npm install --silent )
ok "Node modules installed"

cat <<EOF

${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}
${AMBER}  BBterminal is ready.${RST}
${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}

  Launch:    ${AMBER}./start.sh${RST}
  Stop:      ${AMBER}./stop.sh${RST}
  Docs:      see README.md

${DIM}First launch builds the OpenBB extension cache and takes ~10s longer.${RST}
EOF
