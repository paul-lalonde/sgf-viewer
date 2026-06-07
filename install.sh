#!/usr/bin/env bash
#
# install.sh — set up the SGF viewer and its KataGo dependencies on macOS.
#
# Installs (idempotently — safe to re-run):
#   - Homebrew                (if missing)
#   - git, python3            (via Homebrew if missing)
#   - katago                  (engine for play / score / explore modes)
#   - the KataGo human SL model into ~/.katago  (rank-calibrated play)
#   - KaTrain                 (optional GUI; --skip-katrain to omit)
#
# The viewer itself needs no Python packages — serve.py is stdlib only.
#
# Usage:  ./install.sh [--skip-katrain]
#
set -euo pipefail

SKIP_KATRAIN=0
for arg in "$@"; do
  case "$arg" in
    --skip-katrain) SKIP_KATRAIN=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

HUMAN_MODEL_URL="https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz"
HUMAN_MODEL_PATH="$HOME/.katago/b18c384nbt-humanv0.bin.gz"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this script targets macOS; on Linux install katago and python3 via your package manager."

# --- Homebrew -------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  info "Installing Homebrew (you may be prompted for your password)…"
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# make brew available in this shell regardless of arch (Apple Silicon / Intel)
for prefix in /opt/homebrew /usr/local; do
  [ -x "$prefix/bin/brew" ] && eval "$("$prefix/bin/brew" shellenv)" && break
done
command -v brew >/dev/null 2>&1 || die "Homebrew install failed."
info "Homebrew: $(brew --prefix)"

# --- core tools -----------------------------------------------------------
brew_ensure() {  # install a formula only if its command is absent
  local formula="$1" cmd="${2:-$1}"
  if command -v "$cmd" >/dev/null 2>&1; then
    info "$formula already present ($(command -v "$cmd"))"
  else
    info "Installing $formula…"
    brew install "$formula"
  fi
}
brew_ensure git
brew_ensure python3 python3
brew_ensure katago

info "KataGo: $(katago version 2>/dev/null | head -1 || echo '??')"

# --- human SL model -------------------------------------------------------
if [ -f "$HUMAN_MODEL_PATH" ]; then
  info "Human SL model already present ($(du -h "$HUMAN_MODEL_PATH" | cut -f1))"
else
  info "Downloading KataGo human SL model (~94 MB) → $HUMAN_MODEL_PATH"
  mkdir -p "$(dirname "$HUMAN_MODEL_PATH")"
  curl -fSL -C - -o "$HUMAN_MODEL_PATH" "$HUMAN_MODEL_URL" \
    || die "model download failed; re-run to resume, or set KATAGO_HUMAN_MODEL to your own."
fi

# --- KaTrain (optional GUI) ----------------------------------------------
# Best-effort: a KaTrain failure must not fail the core install, and
# KaTrain needs Python 3.12 (no ffpyplayer wheel on 3.13/3.14 yet).
if [ "$SKIP_KATRAIN" -eq 0 ]; then
  install_katrain() {
    brew_ensure pipx
    pipx ensurepath >/dev/null 2>&1 || true
    if pipx list 2>/dev/null | grep -q "package katrain"; then
      info "KaTrain already installed via pipx"
      return 0
    fi
    command -v python3.12 >/dev/null 2>&1 || brew install python@3.12
    info "Installing KaTrain (pipx, Python 3.12)…"
    pipx install --python python3.12 katrain
  }
  if ! install_katrain; then
    warn "KaTrain install failed — the viewer still works without it. Re-run with --skip-katrain to silence."
  fi
fi

# --- done -----------------------------------------------------------------
echo
bold "Setup complete."
echo "Run the viewer:"
echo "    cd \"$REPO_DIR\" && python3 serve.py"
echo "    open http://127.0.0.1:8000/"
[ "$SKIP_KATRAIN" -eq 0 ] && echo "Launch KaTrain (optional GUI) with:  katrain"
echo
echo "Engine modes (vs engine / score / explore) use the katago on your PATH."
echo "Tune with KATAGO_VISITS, KATAGO_EXPLORE_VISITS — see serve.py header."
