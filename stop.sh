#!/usr/bin/env bash
# BBterminal — stop both servers.

set -u
cd "$(dirname "$0")"

AMBER="\033[33m"; GREEN="\033[32m"; DIM="\033[2m"; RST="\033[0m"
step() { printf "${AMBER}▸ %s${RST}\n" "$*"; }
ok()   { printf "${GREEN}✓ %s${RST}\n" "$*"; }

for port in 6900 6901 5173; do
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    step "Killing processes on :$port"
    kill $pids 2>/dev/null || true
    sleep 1
    # Hard-kill anything that didn't respond
    still=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    [ -n "$still" ] && kill -9 $still 2>/dev/null || true
    ok "Stopped :$port"
  else
    printf "${DIM}  :%d was not running${RST}\n" "$port"
  fi
done

ok "BBterminal stopped"
