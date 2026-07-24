#!/usr/bin/env bash
# Install the compiled gojo CLI onto PATH (Linux / macOS).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SYSTEM=0
for arg in "$@"; do
  case "$arg" in
    --system) SYSTEM=1 ;;
    -h | --help)
      cat <<'EOF'
Usage: bun run install:cli [-- --system]

Build gojo and install the compiled binary:

  default     ~/.local/bin/gojo          (no sudo)
  --system    /usr/local/bin/gojo        (may require sudo)

Also copies the web UI to ~/.gojo/web/dist (or $GOJO_HOME/web/dist).
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Try: bun run install:cli -- --help" >&2
      exit 1
      ;;
  esac
done

OS="$(uname -s)"
case "$OS" in
  Linux | Darwin) ;;
  *)
    echo "install-cli supports Linux and macOS only (got: $OS)" >&2
    exit 1
    ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install from https://bun.sh" >&2
  exit 1
fi

echo "Building gojo (CLI + web UI when available)..."
bun run build

BIN_SRC="$ROOT/bin/gojo"
if [[ ! -x "$BIN_SRC" ]]; then
  echo "Build did not produce an executable at $BIN_SRC" >&2
  exit 1
fi

if [[ "$SYSTEM" -eq 1 ]]; then
  INSTALL_DIR="/usr/local/bin"
  INSTALL_PATH="$INSTALL_DIR/gojo"
  if [[ -w "$INSTALL_DIR" ]]; then
    cp "$BIN_SRC" "$INSTALL_PATH"
  else
    echo "Copying to $INSTALL_PATH (sudo)..."
    sudo cp "$BIN_SRC" "$INSTALL_PATH"
    sudo chmod 755 "$INSTALL_PATH"
  fi
  chmod 755 "$INSTALL_PATH" 2>/dev/null || true
else
  INSTALL_DIR="${HOME}/.local/bin"
  INSTALL_PATH="$INSTALL_DIR/gojo"
  mkdir -p "$INSTALL_DIR"
  cp "$BIN_SRC" "$INSTALL_PATH"
  chmod 755 "$INSTALL_PATH"
fi

GOJO_HOME_DIR="${GOJO_HOME:-$HOME/.gojo}"
WEB_SRC=""
if [[ -d "$ROOT/bin/web/dist" ]]; then
  WEB_SRC="$ROOT/bin/web/dist"
elif [[ -d "$ROOT/web/dist" ]]; then
  WEB_SRC="$ROOT/web/dist"
fi

if [[ -n "$WEB_SRC" ]]; then
  WEB_DEST="$GOJO_HOME_DIR/web/dist"
  rm -rf "$WEB_DEST"
  mkdir -p "$WEB_DEST"
  cp -R "$WEB_SRC/." "$WEB_DEST/"
  echo "Web UI assets → $WEB_DEST"
else
  echo "Warning: no web/dist found; CLI installed but the admin UI may be unavailable until you build web/."
fi

echo "Installed gojo → $INSTALL_PATH"

path_has_dir() {
  local dir="$1"
  local IFS=':'
  local part
  for part in $PATH; do
    if [[ "$part" == "$dir" ]]; then
      return 0
    fi
  done
  return 1
}

if path_has_dir "$INSTALL_DIR"; then
  echo "'$INSTALL_DIR' is already on PATH."
else
  SHELL_NAME="$(basename "${SHELL:-bash}")"
  RC_HINT="~/.bashrc"
  case "$SHELL_NAME" in
    zsh) RC_HINT="~/.zshrc" ;;
    fish) RC_HINT="~/.config/fish/config.fish" ;;
  esac
  echo ""
  echo "'$INSTALL_DIR' is not on your PATH."
  if [[ "$SHELL_NAME" == "fish" ]]; then
    echo "Add this to $RC_HINT, then restart your shell:"
    echo "  fish_add_path $INSTALL_DIR"
  else
    echo "Add this to $RC_HINT, then restart your shell (or run it now):"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  fi
fi

if command -v gojo >/dev/null 2>&1 && [[ "$(command -v gojo)" == "$INSTALL_PATH" || -x "$INSTALL_PATH" ]]; then
  # Prefer the just-installed binary for the smoke check.
  if "$INSTALL_PATH" --help >/dev/null 2>&1; then
    echo ""
    echo "Smoke check OK. Try: gojo --help"
  fi
else
  echo ""
  echo "After PATH is updated, try: gojo --help"
fi
