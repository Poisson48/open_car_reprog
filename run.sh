#!/usr/bin/env bash
# Pull la dernière version et lance le serveur local.
# Usage :
#   ./run.sh              # port 3002 par défaut
#   PORT=3005 ./run.sh    # port perso
#   ./run.sh --no-pull    # skip git pull
#   ./run.sh --no-open    # ne lance pas le navigateur
#
# Prérequis : node 18+, git, navigateur.

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-3002}"
DO_PULL=1
DO_OPEN=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --no-open) DO_OPEN=0 ;;
    --help|-h)
      sed -n '2,10p' "$0" | sed 's/^# //; s/^#//'
      exit 0 ;;
  esac
done

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }

# ── 1. git pull ───────────────────────────────────────────────────────────────
if [ "$DO_PULL" -eq 1 ]; then
  if [ -f ~/.ssh/id_ed25519_poisson48 ]; then
    # remote utilise la clé dédiée poisson48 pour push ; fetch marche aussi sans
    # mais la pose explicitement au cas où git config a une valeur custom.
    say "git pull (poisson48 ssh identity)"
    GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_poisson48 -o IdentitiesOnly=yes' git pull --ff-only origin main
  else
    say "git pull"
    git pull --ff-only origin main
  fi
else
  say "skip git pull (--no-pull)"
fi

# ── 2. npm install si package.json a bougé ────────────────────────────────────
if [ -f package.json ]; then
  if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
    say "npm install"
    npm install --no-audit --no-fund
  fi
fi

# ── 3. kill tout node server.js qui traîne sur notre port ─────────────────────
if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
  PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    say "port $PORT occupé, kill $PIDS"
    kill -9 $PIDS 2>/dev/null || warn "certains PIDs root, impossible à kill sans sudo — continue"
    sleep 1
  fi
fi

# ── 4. lance le serveur en arrière-plan + attend qu'il soit up ────────────────
say "node server.js sur :$PORT"
LOG="/tmp/open-car-reprog-${PORT}.log"
nohup env PORT="$PORT" node server.js > "$LOG" 2>&1 &
SERVER_PID=$!
disown

# Attend jusqu'à 10 s que /api/version réponde
for i in $(seq 1 20); do
  if curl -sf "http://localhost:$PORT/api/version" > /dev/null 2>&1; then
    VERSION=$(curl -s "http://localhost:$PORT/api/version" | grep -oE '"version":"[^"]*"' | cut -d'"' -f4)
    say "✅ serveur up — version $VERSION — pid $SERVER_PID"
    say "log : tail -f $LOG"
    break
  fi
  sleep 0.5
done

if ! curl -sf "http://localhost:$PORT/api/version" > /dev/null 2>&1; then
  warn "serveur pas joignable après 10 s — check $LOG"
  tail -20 "$LOG"
  exit 1
fi

# ── 5. ouvre le navigateur ────────────────────────────────────────────────────
URL="http://localhost:$PORT"
if [ "$DO_OPEN" -eq 1 ]; then
  if command -v xdg-open > /dev/null 2>&1; then
    say "xdg-open $URL"
    xdg-open "$URL" > /dev/null 2>&1 &
  else
    say "ouvre : $URL"
  fi
else
  say "skip navigateur (--no-open) — url : $URL"
fi

# ── 6. arrêt propre sur Ctrl-C (optionnel — le serveur reste en fond) ────────
echo
say "pour arrêter le serveur : kill $SERVER_PID  ou  lsof -ti :$PORT | xargs kill -9"
